import * as THREE from "three/webgpu";
import crewUrl from "../../../../content/tracks/hill-country/crew.glb?url";
import frameUrl from "../../../../content/tracks/hill-country/sd-frame.json?url";
import racingLineUrl from "../../../../content/tracks/hill-country/racing-line.json?url";
import trackUrl from "../../../../content/tracks/hill-country/track.json?url";
import roadUrl from "../../../../content/tracks/hill-country/road.glb?url";
import { FieldCars } from "./field-cars.ts";
import { frameIndex, type Engine, type HudInfo } from "./engine.ts";
import type { WeatherInfo } from "./weather.ts";
import { RainStreaks, Spray } from "./rain.ts";
import { rainLight } from "./carpaint.ts";
import { Debris, partCount, updateLook } from "./car-damage.ts";
import { carField, carStride } from "./frame-layout.ts";
import { GltfCar, placeOnTrack, type TrackFrame } from "./gltf.ts";
import { GridCars, type GridSlot } from "./grid.ts";
import {
  cascadeLayers,
  loadRoad,
  releaseCpuCopies,
  setCarContact,
  setStartLights,
  setWetness,
  type SkyRadiance,
  Sunlight,
} from "./road.ts";
import { Rumble, type RumbleWheel, type Shake } from "./rumble.ts";
import type { AtmosphereState } from "./atmosphere.ts";
import type { CameraPose } from "./buildup-shots.ts";
import type { RacingLineData, RacingLineMode } from "./racing-line.ts";
import { RacingLineView } from "./racing-line-view.ts";
import { PitCrew } from "./pit-crew.ts";
import { releaseUploadedImages, uploadEverything } from "./preload.ts";
import { PitGate } from "./pit-gate.ts";
import type { PitControl, PitLayout } from "./pitstop.ts";
import { SkidMarks } from "./skidmarks.ts";
import { SafetyCar } from "./safety-car.ts";
import type { StartLights } from "./start-lights.ts";
import { SdSky } from "./sky.ts";
import { SkyBox } from "./skybox.ts";
import { Crowd } from "./crowd.ts";
import { TyreSmoke } from "./tyre-smoke.ts";
import { frustumContains, WorldCuller } from "./world-culler.ts";
import type { TyreInfo } from "./tyres.ts";

const gateLead = 30;
const onboardReach = 3;
const crewReach = 12;
const flipX = new THREE.Matrix4().makeScale(-1, 1, 1);
const sunGlow = 2.4;
const kelvinOffset = 273.15;
const cinematicNear = 0.5;
const cinematicFar = 41000;
const upAxis = new THREE.Vector3(0, 0, 1);
const clearVisibility = 16000;
const rainVisibility = 650;
const overcastSun = 0.86;
const overcastExposure = 0.3;
const overcastAmbient = 0.4;
const rainDarkening = 0.4;
const overcastHaze = 0.72;
const chaseLens = 0.4;
const lensSpeed = 65;
const sprayLight = 0.75;
const streakLight = 0.6;
const forecastShare = 0.7;
const cloudsFromWater = 1.6;
const cloudSeconds = 25;
const rainLightHertz = 4;
const rainLightWater = 0.12;
const dryWeather: WeatherInfo = {
  rain: 0,
  lineWater: 0,
  offWater: 0,
  carWater: 0,
  clock: 0,
  slickLimit: 0,
  interLimit: 0,
  forecast: [],
};

function presentRoots(
  ...items: ({ root: THREE.Object3D } | null)[]
): THREE.Object3D[] {
  return items.flatMap((item) => (item ? [item.root] : []));
}

export async function fetchJson<T>(url: string): Promise<T> {
  THREE.DefaultLoadingManager.itemStart(url);
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`failed to load ${url}`);
    return (await response.json()) as T;
  } finally {
    THREE.DefaultLoadingManager.itemEnd(url);
  }
}

const defaultTextureLimit = 8192;

export class Scene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(67.5, 1, 1, 41000);
  private readonly view = new THREE.Matrix4();
  private readonly rumble = new Rumble();
  private readonly shakeMatrix = new THREE.Matrix4();
  private readonly cinematicLook = new THREE.Matrix4();
  private shake: Shake | null = null;
  private lastFeel = 0;
  private readonly eye = new THREE.Vector3();
  private readonly carPosition = new THREE.Vector3();
  private viewMirrored = false;
  private cinematic: CameraPose | null = null;
  private readonly sunlight: Sunlight;
  private readonly smoke = new TyreSmoke();
  private readonly rain = new RainStreaks();
  private readonly spray = new Spray();
  private readonly debris = new Debris();
  private readonly damageMatrix = new THREE.Matrix4();
  private readonly damageVelocity = new THREE.Vector3();
  private weather = dryWeather;
  private overcast = -1;
  private weatherTime = 0;
  private cars: Float64Array | null = null;
  private readonly baseHaze = new THREE.Color();
  private readonly greyHaze = new THREE.Color();
  private readonly streakColour = new THREE.Color();
  private readonly sprayColour = new THREE.Color();
  private baseExposure = 1;
  private readonly moving: THREE.Object3D[];
  private readonly safetyCar = new SafetyCar();
  private signalAt = 0;
  private readonly viewFrustum = new THREE.Frustum();
  private mirrorViews: THREE.Frustum[] = [];
  private insetView: THREE.Frustum | null = null;
  private liveFrame: Float64Array | null = null;
  private liveDraw: [boolean, boolean, boolean] | null = null;
  private liveShown: boolean[] = [];
  private readonly seen = {
    intersectsSphere: (sphere: THREE.Sphere): boolean =>
      this.viewFrustum.intersectsSphere(sphere) ||
      this.mirrorViews.some((view) => view.intersectsSphere(sphere)) ||
      (this.insetView?.intersectsSphere(sphere) ?? false),
    containsSphere: (sphere: THREE.Sphere): boolean =>
      frustumContains(this.viewFrustum, sphere),
  };
  private readonly viewMatrix = new THREE.Matrix4();
  private warming = false;
  private crewOut = false;
  private compound = 1;
  private fittedCompound = 1;
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
    visibility: clearVisibility,
    lensWater: 0,
    airflow: 0,
    time: 0,
    detail: false,
  };

  private constructor(
    private readonly sky: SdSky,
    private readonly skyBox: SkyBox,
    private readonly people: Crowd,
    private readonly car: GltfCar,
    private readonly grid: GridCars | null,
    track: THREE.Object3D,
    private readonly road: THREE.Object3D,
    private readonly culler: WorldCuller,
    private readonly racingLine: RacingLineView,
    readonly crew: PitCrew,
    private readonly lapScale: number,
    private readonly field: FieldCars | null,
    private lights: StartLights,
  ) {
    this.camera.matrixAutoUpdate = false;
    this.camera.matrixWorldAutoUpdate = false;
    this.scene.environment = skyBox.environment;
    const extras = presentRoots(grid, field);
    this.scene.add(
      skyBox.mesh,
      track,
      car.root,
      this.smoke.root,
      this.rain.mesh,
      this.spray.root,
      this.debris.root,
      ...extras,
    );
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
    this.baseExposure = skyBox.exposure;
    this.baseHaze.copy(this.atmosphere.haze);
    const grey =
      (0.2126 * (horizon[0] ?? 1) +
        0.7152 * (horizon[1] ?? 1) +
        0.0722 * (horizon[2] ?? 1)) *
      overcastHaze;
    this.greyHaze.setRGB(grey * 0.95, grey * 0.98, grey);
    this.scene.add(
      this.marks.mesh,
      this.crew.root,
      this.gate.mesh,
      this.safetyCar.root,
    );
    this.moving = [
      skyBox.mesh,
      car.root,
      this.gate.mesh,
      this.safetyCar.root,
      ...extras,
    ];
    culler.narrowViews();
    car.focusMirror = (view) => {
      culler.focus(view);
    };
    this.scene.updateMatrixWorld(true);
    this.scene.matrixWorldAutoUpdate = false;
    culler.bake();
  }

  static async load(
    engine: Engine,
    team: string,
    renderer: THREE.WebGPURenderer,
    lineMode: RacingLineMode,
    rivals: string[],
    lights: StartLights,
  ): Promise<Scene> {
    const anisotropy = renderer.getMaxAnisotropy();
    const textureLimit =
      (renderer.backend as { device?: GPUDevice }).device?.limits
        .maxTextureDimension2D ?? defaultTextureLimit;
    const local = engine.trackLocal();
    const hours = local.timeOfDay / 3600;
    const elevation = ((90 - 15 * Math.abs(hours - 12)) * Math.PI) / 180;
    const skyLoad = SkyBox.load(elevation, hours > 12);
    const envLoad = skyLoad.then((sky) => ({
      texture: sky.environment,
      rotation: sky.environmentRotation,
    }));
    const point = engine.trackPoint.bind(engine);
    const [skyBox, env, frame, people, road, data, crew, car, gridData] =
      await Promise.all([
        skyLoad,
        envLoad,
        fetchJson<TrackFrame>(frameUrl),
        Crowd.load(),
        loadRoad(
          roadUrl,
          anisotropy,
          textureLimit,
          skyLoad.then(
            (sky): SkyRadiance =>
              (direction) =>
                sky.radiance(direction, false),
          ),
        ),
        fetchJson<RacingLineData>(racingLineUrl),
        envLoad.then((loaded) =>
          PitCrew.load(crewUrl, anisotropy, loaded, team),
        ),
        envLoad.then((loaded) => GltfCar.load(team, renderer, loaded)),
        fetchJson<{ length: number; grid: GridSlot[] }>(trackUrl),
      ]);
    const lengthScale = engine.trackLength() / gridData.length;
    const grid =
      rivals.length > 0
        ? null
        : await GridCars.load(
            team,
            gridData.grid.map((slot) => ({
              distance: slot.distance * lengthScale,
              offset: slot.offset,
            })),
            point,
            env,
          );
    const field = rivals.length > 0 ? await FieldCars.load(rivals, env) : null;
    const racingLine = new RacingLineView(data, data.profile, lineMode);
    const start = engine.trackPoint(0, 0);
    const placed = placeOnTrack(road, frame, start);
    placed.updateMatrixWorld(true);
    const culler = new WorldCuller(road, cascadeLayers);
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
      field,
      lights,
    );
  }

  updateField(cars: Float64Array): void {
    this.cars = cars;
    this.field?.update(cars, this.camera);
  }

  updateSafetyCar(
    pose: ArrayLike<number> | null,
    lightsOn: boolean,
    now: number,
  ): void {
    this.safetyCar.update(pose, lightsOn, now);
  }

  restartLights(lights: StartLights, signalAt: number): void {
    this.lights = lights;
    this.signalAt = signalAt;
  }

  get fieldCars(): Float64Array | null {
    return this.cars;
  }

  setDamage(damage: Float64Array, frame: Float64Array): void {
    const count = Math.floor(damage.length / partCount);
    for (let i = 0; i < count; i++) {
      const look = i === 0 ? this.car.damage : this.field?.damageOf(i);
      if (!look) continue;
      const changes = updateLook(look, damage, i * partCount);
      if (changes.length > 0 && this.placeDamaged(i, frame))
        for (const change of changes)
          this.debris.spawn(this.damageMatrix, this.damageVelocity, change);
    }
  }

  private placeDamaged(index: number, frame: Float64Array): boolean {
    const source = index === 0 ? frame : this.cars;
    if (!source) return false;
    const at = index === 0 ? frameIndex.posMat : index * carStride;
    const speed =
      index === 0
        ? (frame[frameIndex.speed] ?? 0)
        : (source[at + carField.speed] ?? 0);
    this.damageMatrix.fromArray(source, at);
    this.damageVelocity
      .setFromMatrixColumn(this.damageMatrix, 0)
      .multiplyScalar(speed);
    return true;
  }

  clearDebris(): void {
    this.debris.clear();
  }

  setWeather(weather: WeatherInfo): void {
    this.weather = weather;
  }

  private applyWeather(frame: Float64Array, onboard: boolean): void {
    const w = this.weather;
    const time = frame[frameIndex.time] ?? 0;
    const rain = w.rain;
    const coming = Math.max(rain, (w.forecast[0] ?? 0) * forecastShare);
    const target = Math.min(
      1,
      Math.max(coming * 4, w.offWater * cloudsFromWater),
    );
    const dt = Math.max(0, Math.min(1, time - this.weatherTime));
    this.weatherTime = time;
    this.overcast =
      this.overcast < 0
        ? target
        : this.overcast +
          (target - this.overcast) * Math.min(1, dt / cloudSeconds);
    const overcast = this.overcast;
    this.skyBox.overcast.value = overcast;
    this.skyBox.overcastLight.value = 1 - rainDarkening * rain;
    this.skyBox.cloudTime.value = time;
    this.sunlight.dim(1 - overcastSun * overcast);
    this.scene.environmentIntensity = 1 - overcastAmbient * overcast;
    this.atmosphere.exposure =
      this.baseExposure * (1 + overcastExposure * overcast);
    this.atmosphere.haze.copy(this.baseHaze).lerp(this.greyHaze, overcast);
    this.atmosphere.visibility =
      clearVisibility +
      (rainVisibility - clearVisibility) * Math.pow(rain, 0.6);
    const speed = Math.abs(frame[frameIndex.speed] ?? 0);
    this.atmosphere.lensWater = rain * (onboard ? 1 : chaseLens);
    this.atmosphere.airflow = Math.min(1, speed / lensSpeed);
    this.atmosphere.time = time;
    setWetness(w.lineWater, w.offWater);
    const wet = w.rain > 0.05 || w.lineWater > rainLightWater;
    rainLight.value = wet
      ? Math.sin(time * Math.PI * 2 * rainLightHertz) > 0
        ? 1
        : 0.12
      : 0;
    const haze = this.atmosphere.haze;
    this.streakColour.copy(haze).multiplyScalar(streakLight);
    this.sprayColour.copy(haze).multiplyScalar(sprayLight);
    this.rain.update(rain, this.eye, time, this.streakColour);
    this.spray.update(
      time,
      { rain, water: (w.lineWater + w.offWater) / 2 },
      frame,
      this.cars,
      this.eye,
      this.sprayColour,
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

  updatePit(control: PitControl, frame: Float64Array, fresh: number): void {
    this.crewOut = control.phase !== "track";
    const active = control.phase === "service";
    if (!active) this.fittedCompound = this.compound;
    this.crew.setCompounds(this.fittedCompound, fresh);
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
    if (this.warming) this.crew.root.visible = true;
    this.car.renderAuxiliary(renderer, this.scene);
  }

  setDash(info: HudInfo): void {
    this.car.setDash({
      fuel: info.tank > 0 ? info.fuel / info.tank : 0,
      tyres: info.tyreTemp.map((kelvin) => kelvin - kelvinOffset),
    });
  }

  get playerSlot(): number {
    return this.grid?.playerSlot ?? 0;
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
  }

  private applyCinematic(pose: CameraPose): void {
    const eye = new THREE.Vector3(...pose.eye);
    this.cinematicLook.lookAt(eye, new THREE.Vector3(...pose.target), upAxis);
    this.cinematicLook.setPosition(eye);
    this.camera.matrixWorld.copy(this.cinematicLook);
    this.camera.matrixWorldInverse.copy(this.cinematicLook).invert();
    this.viewMirrored = false;
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
    this.sunlight.refit();
  }

  private applyDriverView(frame: Float64Array): void {
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

  showInset(view: THREE.Frustum | null): void {
    this.insetView = view;
  }

  posePast(frame: Float64Array, cars: Float64Array, eye: THREE.Camera): void {
    if (!this.liveDraw) {
      this.liveDraw = this.car.drawn;
      this.liveShown = this.presentOnly().map((root) => root.visible);
    }
    this.car.pose(frame);
    this.car.setDraw(true, true, false);
    for (const root of this.presentOnly()) root.visible = false;
    this.field?.update(cars, eye);
    this.commitPoses();
  }

  posePresent(): void {
    if (!this.liveDraw || !this.liveFrame) return;
    this.car.pose(this.liveFrame);
    this.car.setDraw(...this.liveDraw);
    this.liveDraw = null;
    this.presentOnly().forEach((root, k) => {
      root.visible = this.liveShown[k] ?? true;
    });
    if (this.cars) this.field?.update(this.cars, this.camera);
    this.commitPoses();
  }

  private presentOnly(): THREE.Object3D[] {
    return [this.racingLine.root, this.safetyCar.root, this.debris.root];
  }

  private commitPoses(): void {
    for (const object of this.moving)
      if (object.visible) object.updateMatrixWorld();
  }

  update(frame: Float64Array): void {
    this.liveFrame = frame;
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
    this.grid?.update(frame);
    const shown = (k: number) =>
      this.cinematic !== null || (frame[frameIndex.camera + k] ?? 0) !== 0;
    const onboard =
      this.eye
        .set(eyeX, eyeY, eyeZ)
        .distanceToSquared(
          this.carPosition.setFromMatrixPosition(this.car.root.matrix),
        ) <
      onboardReach * onboardReach;
    this.car.setDraw(shown(19), shown(20), onboard);
    const time = frame[frameIndex.time] ?? 0;
    const lit = this.lights.lit(time - this.signalAt);
    setStartLights(this.cinematic ? 0 : lit);
    const sky = this.sky.update(time, time, eyeX, eyeY);
    const [focusX, focusY, focusZ] = this.cinematic?.target ?? [
      eyeX,
      eyeY,
      eyeZ,
    ];
    this.sunlight.update(sky, focusX, focusY, focusZ);
    this.atmosphere.sunDirection.copy(this.sunlight.direction);
    this.skyBox.update(this.sunlight.direction, eyeX, eyeY, this.scene);
    this.people.update(this.eye.set(eyeX, eyeY, eyeZ));
    this.applyWeather(frame, onboard);
    this.debris.update(time);
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
    this.culler.update(this.seen, this.sunlight.cascadeViews);
  }

  hideUnseenCrew(): void {
    const { root } = this.crew;
    if (!this.warming) {
      this.crewBounds.center.setFromMatrixPosition(root.matrix);
      root.visible =
        this.crewOut &&
        (this.seen.intersectsSphere(this.crewBounds) ||
          this.sunlight.intersectsSphere(this.crewBounds));
    }
    if (!root.visible) return;
    this.crew.prepare();
    root.updateMatrixWorld();
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
    releaseUploadedImages(renderer, this.scene);
  }

  updateTyres(frame: Float64Array, tyres: TyreInfo): void {
    this.smoke.update(frame, tyres, this.car.wheelRadii());
    this.car.setCompound(tyres.compound);
    this.compound = tyres.compound;
    this.car.setDeflation(tyres.wheels.map((wheel) => wheel.leak));
    this.car.setWear(tyres.wheels.map((wheel) => wheel.wear));
  }

  resize(width: number, height: number, pixelRatio = 1): void {
    this.field?.resize(height * pixelRatio);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.sunlight.refit();
  }
}
