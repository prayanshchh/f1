import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { float, smoothstep, uv, vec3 } from "three/tsl";
import { carMaterials, carTextures, mirrorLayout } from "./carpaint.ts";
import {
  damageable,
  type DamageLook,
  newLook,
  tagDamageZones,
  zeroZones,
} from "./car-damage.ts";
import type {
  CarEnvironment,
  CarMaterials,
  CarTextures,
  DashReadout,
  MirrorName,
} from "./carpaint.ts";
import { frameIndex } from "./frame-layout.ts";
import { mergedMesh, placedCopy } from "./merge.ts";
import { setTyreShadows, shadowOnlyLayer } from "./road.ts";
import { carFile } from "./teams.ts";
import { compounds, type WheelTyre } from "./tyres.ts";
import {
  deflatedSag,
  markTyres,
  spinBlur,
  treadPattern,
  type TyreLook,
  tyreLook,
  tyreMaterial,
} from "./tyre-paint.ts";

export const gltfToSdWorld = new THREE.Matrix4().set(
  1,
  0,
  0,
  0,
  0,
  0,
  -1,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  0,
  1,
);
export const gltfToSdCar = new THREE.Matrix4().set(
  0,
  0,
  1,
  0,
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  0,
  1,
);
const wheelNames = ["wheel-fr", "wheel-fl", "wheel-rr", "wheel-rl"] as const;
const mirrorDistance = 1200;
const mirrorInterval = 2;
const mirrorPixels = [1024, 320] as const;
const mirrorFov = 15;
const mirrorForward = 0.62;
const mirrorOutward = 0.12;
const mirrorNames: MirrorName[] = ["mirror-l", "mirror-r"];

export interface MirrorView {
  intersectsSphere(sphere: THREE.Sphere): boolean;
}

const everywhere: MirrorView = { intersectsSphere: () => true };
export const wheelRest = [
  new THREE.Vector3(0.78, 0, 1.7),
  new THREE.Vector3(-0.78, 0, 1.7),
  new THREE.Vector3(0.75, 0, -1.7),
  new THREE.Vector3(-0.75, 0, -1.7),
];
const shortestFrame = 1 / 240;
const longestFrame = 1 / 20;
const contactMargin = 0.5;
const contactDarkness = 0.55;
const contactLift = 0.02;
const steeringWheelRotation = 2.0;
const cockpitOnly =
  /^(wheel-(face|screen|bezel|rotary|metal)|btn-|grip|glove|led-(green|wheel-red|purple))/;

export interface TrackFrame {
  origin: number[];
  heading: number;
}

export function placeOnTrack(
  object: THREE.Object3D,
  frame: TrackFrame,
  sdStart: [number, number, number],
): THREE.Object3D {
  const [ox = 0, oy = 0, oz = 0] = frame.origin;
  const root = new THREE.Group();
  root.matrixAutoUpdate = false;
  root.matrix
    .makeTranslation(sdStart[0], sdStart[1], sdStart[2])
    .multiply(new THREE.Matrix4().makeRotationZ(-frame.heading))
    .multiply(new THREE.Matrix4().makeTranslation(-ox, oz, -oy))
    .multiply(gltfToSdWorld);
  root.add(object);
  return root;
}

interface Wheel {
  pivot: THREE.Object3D;
  spin: THREE.Object3D;
  tyre: THREE.Object3D | null;
  rest: THREE.Vector3;
  restZ: number | null;
  look: TyreLook;
  flatSpin: number;
}

export function contactShadow(wheels: THREE.Vector3[]): THREE.Mesh {
  const along = wheels.map((w) => w.z);
  const across = wheels.map((w) => w.x);
  const length = Math.max(...along) - Math.min(...along) + contactMargin * 2;
  const width = Math.max(...across) - Math.min(...across) + contactMargin;
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: 4,
    polygonOffsetUnits: 16,
  });
  const centred = uv().sub(0.5).mul(2);
  material.colorNode = vec3(0);
  material.opacityNode = float(1)
    .sub(smoothstep(0.35, 1, centred.length()))
    .mul(contactDarkness);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(length, width),
    material,
  );
  shadow.position.set(
    (Math.max(...along) + Math.min(...along)) / 2,
    0,
    contactLift,
  );
  shadow.renderOrder = 1;
  return shadow;
}

const worldDown = new THREE.Vector3(0, 0, -1);
const towardGround = new THREE.Vector3();
const meshToWorld = new THREE.Matrix4();

function groundIn(mesh: THREE.Object3D, out: THREE.Vector2): THREE.Vector2 {
  meshToWorld.copy(mesh.matrixWorld).invert();
  towardGround.copy(worldDown).transformDirection(meshToWorld);
  return out.set(towardGround.y, towardGround.z).normalize();
}

function shadowCaster(model: THREE.Object3D): THREE.Object3D {
  model.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  model.traverse((object) => {
    if (object instanceof THREE.Mesh)
      parts.push(
        placedCopy(
          object.geometry as THREE.BufferGeometry,
          object.matrixWorld,
          ["position"],
        ),
      );
  });
  const caster = mergedMesh(
    parts,
    new THREE.MeshBasicNodeMaterial({ shadowSide: THREE.BackSide }),
  );
  caster.castShadow = true;
  caster.layers.set(shadowOnlyLayer);
  return caster;
}

function withinChassis(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent)
    if (node.name === "chassis") return true;
  return false;
}

export function makeDamageable(
  model: THREE.Object3D,
  look: DamageLook,
  breakable: (mesh: THREE.Mesh) => boolean,
): void {
  const meshes: THREE.Mesh[] = [];
  model.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object as THREE.Mesh);
  });
  const zoned = new Set<THREE.Material>();
  for (const mesh of meshes)
    if (breakable(mesh) && tagDamageZones(mesh.geometry))
      zoned.add(mesh.material as THREE.Material);
  for (const mesh of meshes) {
    if (!zoned.has(mesh.material as THREE.Material)) continue;
    zeroZones(mesh.geometry);
    mesh.userData = { ...mesh.userData, damage: look };
  }
  for (const material of zoned) damageable(material as THREE.NodeMaterial);
}

export class GltfCar {
  readonly root = new THREE.Group();
  readonly damage = newLook();
  private readonly model = new THREE.Group();
  private readonly wheels: Wheel[] = [];
  private steeringWheel: THREE.Object3D | null = null;
  private driverHead: THREE.Object3D | null = null;
  private visualAxleMid = 0;
  private visualWheelHeight = 0;
  private offsetReady = false;
  private contacts: { centre: THREE.Vector3; axis: THREE.Vector3 }[] = [];
  private lift = 0;
  private heave = 0;
  private roll = 0;
  private wheelsOff = false;
  private readonly rollMatrix = new THREE.Matrix4();
  private readonly basisY = new THREE.Vector3();
  private readonly basisZ = new THREE.Vector3();
  private readonly compoundColour = new THREE.Color(compounds[1].colour);
  private sharedTyres: THREE.Material | null = null;
  private compoundShown = -1;
  private readonly radii: number[] = [];
  private materials: CarMaterials | null = null;
  private textures: CarTextures | null = null;
  private auxFrame = 0;
  private mirrorsShown = false;
  private onboard = true;
  private readonly glass: THREE.Object3D[] = [];
  private readonly cockpitParts: THREE.Object3D[] = [];
  private readonly mirrors = new Map<
    MirrorName,
    {
      target: THREE.RenderTarget;
      camera: THREE.PerspectiveCamera;
      view: THREE.Frustum;
    }
  >();
  private readonly viewMatrix = new THREE.Matrix4();
  focusMirror: (view: MirrorView | null) => void = () => undefined;
  private dash: Pick<DashReadout, "fuel" | "tyres"> = {
    fuel: 1,
    tyres: [0, 0, 0, 0],
  };

  private addMirror(name: MirrorName): THREE.Texture {
    const layout = mirrorLayout[name];
    const target = new THREE.RenderTarget(mirrorPixels[0], mirrorPixels[1], {
      type: THREE.HalfFloatType,
    });
    const camera = new THREE.PerspectiveCamera(
      mirrorFov,
      mirrorPixels[0] / mirrorPixels[1],
      0.08,
      mirrorDistance,
    );
    camera.position.set(mirrorForward, layout.across, layout.up);
    const outward = Math.sign(layout.across) * mirrorOutward;
    camera.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(
        new THREE.Vector3(outward, 1, 0).normalize(),
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(1, -outward, 0).normalize(),
      ),
    );
    this.model.add(camera);
    this.mirrors.set(name, { target, camera, view: new THREE.Frustum() });
    return target.texture;
  }
  private readonly flatDown = new THREE.Vector2();
  private posedAt = 0;

  static async load(
    team: string,
    renderer: THREE.WebGPURenderer,
    env: CarEnvironment,
  ): Promise<GltfCar> {
    const car = new GltfCar();
    const anisotropy = renderer.getMaxAnisotropy();
    const loader = new GLTFLoader();
    const [gltf, lod] = await Promise.all([
      loader.loadAsync(carFile(team, "car.glb")),
      loader.loadAsync(carFile(team, "lod.glb")),
    ]);
    car.textures = carTextures(team, anisotropy);
    const materials = carMaterials(car.textures, env, {
      "mirror-l": car.addMirror("mirror-l"),
      "mirror-r": car.addMirror("mirror-r"),
    });
    car.materials = materials;
    const tyres = tyreMaterial(env, anisotropy);
    car.sharedTyres = tyres;
    gltf.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const source = object.material as THREE.MeshStandardMaterial;
      object.receiveShadow = true;
      if (source.name === "tyre") {
        markTyres(object.geometry as THREE.BufferGeometry, false);
        object.material = tyres;
        return;
      }
      if (source.name.startsWith("mirror-")) car.glass.push(object);
      if (cockpitOnly.test(source.name)) car.cockpitParts.push(object);
      object.material = materials.build(source);
    });
    makeDamageable(gltf.scene, car.damage, withinChassis);
    const axes = new THREE.Group();
    axes.matrixAutoUpdate = false;
    axes.matrix.copy(gltfToSdCar);
    axes.add(gltf.scene, shadowCaster(lod.scene));
    car.model.add(axes);
    car.root.matrixAutoUpdate = false;
    car.root.add(car.model);
    for (const name of wheelNames) {
      const pivot = gltf.scene.getObjectByName(name);
      const spin = gltf.scene.getObjectByName(`${name}-spin`);
      if (!pivot || !spin) throw new Error(`car model has no ${name}`);
      const look = { ...tyreLook(), compound: car.compoundColour };
      let tyre: THREE.Object3D | null = null;
      spin.traverse((part) => {
        if ((part as THREE.Mesh).material !== tyres) return;
        part.userData = { ...part.userData, tyre: look };
        tyre ??= part;
      });
      car.wheels.push({
        pivot,
        spin,
        tyre,
        rest: pivot.position.clone(),
        restZ: null,
        look,
        flatSpin: 0,
      });
    }
    car.measureWheels();
    car.steeringWheel = gltf.scene.getObjectByName("steering-wheel") ?? null;
    car.driverHead = gltf.scene.getObjectByName("driver-head") ?? null;
    car.visualAxleMid =
      ((car.wheels[0]?.rest.z ?? 0) + (car.wheels[2]?.rest.z ?? 0)) / 2;
    car.visualWheelHeight =
      car.wheels.reduce((sum, w) => sum + w.rest.y, 0) / car.wheels.length;
    car.contacts = car.wheels.map(() => ({
      centre: new THREE.Vector3(),
      axis: new THREE.Vector3(),
    }));
    return car;
  }

  dispose(): void {
    this.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      (object.geometry as THREE.BufferGeometry).dispose();
      if (object.material !== this.sharedTyres)
        (object.material as THREE.Material).dispose();
    });
    for (const map of Object.values(this.textures ?? {}))
      (map as THREE.Texture).dispose();
    for (const mirror of this.mirrors.values()) mirror.target.dispose();
  }

  private measureWheels(): void {
    const size = new THREE.Vector3();
    for (const wheel of this.wheels) {
      new THREE.Box3().setFromObject(wheel.spin).getSize(size);
      this.radii.push(Math.max(size.y, size.z) / 2);
    }
  }

  setCompound(index: number): void {
    if (index === this.compoundShown) return;
    this.compoundShown = index;
    this.compoundColour.set((compounds[index] ?? compounds[1]).colour);
    for (const wheel of this.wheels) wheel.look.pattern = treadPattern(index);
  }

  wheelRadii(): number[] {
    return this.radii;
  }

  setDraw(current: boolean, driver: boolean, onboard: boolean): void {
    this.root.visible = current;
    this.mirrorsShown = current && onboard;
    if (onboard !== this.onboard)
      for (const part of this.cockpitParts) part.visible = onboard;
    this.onboard = onboard;
    if (this.driverHead) this.driverHead.visible = driver;
  }

  setRumble(heave: number, roll: number): void {
    this.heave = heave;
    this.roll = roll;
  }

  setPitService(lift: number, wheelsOff: boolean): void {
    this.lift = lift;
    this.wheelsOff = wheelsOff;
  }

  private updateTyreShadows(): void {
    this.root.updateMatrixWorld(true);
    this.wheels.forEach((wheel, i) => {
      const contact = this.contacts[i];
      if (!contact) return;
      wheel.pivot.matrixWorld.extractBasis(
        contact.axis,
        this.basisY,
        this.basisZ,
      );
      contact.axis.normalize();
      contact.centre.setFromMatrixPosition(wheel.pivot.matrixWorld);
    });
    setTyreShadows(!this.wheelsOff, this.contacts);
  }

  private orientTyres(): void {
    for (const wheel of this.wheels) {
      if (!wheel.tyre) continue;
      groundIn(wheel.tyre, wheel.look.down);
      if (wheel.look.flat <= 0) continue;
      const turning = wheel.spin.rotation.x;
      wheel.spin.rotation.x = wheel.flatSpin;
      wheel.spin.updateMatrixWorld(true);
      groundIn(wheel.tyre, this.flatDown);
      wheel.look.flatTurn =
        Math.atan2(this.flatDown.y, this.flatDown.x) / (Math.PI * 2);
      wheel.spin.rotation.x = turning;
      wheel.spin.updateMatrixWorld(true);
    }
  }

  setDash(dash: Pick<DashReadout, "fuel" | "tyres">): void {
    this.dash = dash;
  }

  private renderMirror(
    renderer: THREE.WebGPURenderer,
    scene: THREE.Scene,
  ): void {
    const name =
      mirrorNames[
        Math.floor(this.auxFrame / mirrorInterval) % mirrorNames.length
      ];
    const mirror = name ? this.mirrors.get(name) : undefined;
    if (mirror) this.drawMirror(renderer, scene, mirror, this.viewOf(mirror));
  }

  private drawMirror(
    renderer: THREE.WebGPURenderer,
    scene: THREE.Scene,
    mirror: { target: THREE.RenderTarget; camera: THREE.PerspectiveCamera },
    view: MirrorView,
  ): void {
    for (const glass of this.glass) glass.visible = false;
    this.focusMirror(view);
    renderer.setRenderTarget(mirror.target);
    renderer.render(scene, mirror.camera);
    this.focusMirror(null);
    for (const glass of this.glass) glass.visible = true;
  }

  warmMirrors(renderer: THREE.WebGPURenderer, scene: THREE.Scene): void {
    this.root.updateWorldMatrix(true, true);
    const previous = renderer.getRenderTarget();
    for (const mirror of this.mirrors.values())
      this.drawMirror(renderer, scene, mirror, everywhere);
    renderer.setRenderTarget(previous);
  }

  private viewOf(mirror: {
    camera: THREE.PerspectiveCamera;
    view: THREE.Frustum;
  }): THREE.Frustum {
    const { camera, view } = mirror;
    camera.updateWorldMatrix(true, false);
    return view.setFromProjectionMatrix(
      this.viewMatrix.multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      ),
      camera.coordinateSystem,
      camera.reversedDepth,
    );
  }

  mirrorViews(): THREE.Frustum[] {
    if (!this.mirrorsShown) return [];
    return Array.from(this.mirrors.values(), (mirror) => this.viewOf(mirror));
  }

  renderAuxiliary(renderer: THREE.WebGPURenderer, scene: THREE.Scene): void {
    if (!this.mirrorsShown) return;
    this.auxFrame++;
    if (this.auxFrame % mirrorInterval !== 0) return;
    this.root.updateWorldMatrix(true, true);
    const previous = renderer.getRenderTarget();
    this.renderMirror(renderer, scene);
    renderer.setRenderTarget(previous);
  }

  setTyreCondition(wheels: WheelTyre[]): void {
    const unit = (value: number) => THREE.MathUtils.clamp(value, 0, 1);
    this.wheels.forEach((wheel, i) => {
      const state = wheels[i];
      if (!state) return;
      const look = wheel.look;
      look.wear = unit(state.wear);
      look.flat = unit(state.flat);
      look.shred = unit(state.shred);
      look.sag = deflatedSag(state.leak);
      look.dirt = unit(state.dirt);
      look.gravel = unit(state.gravel);
      look.wet = unit(state.water);
      wheel.flatSpin = state.flatAt;
    });
  }

  update(frame: Float64Array): void {
    this.pose(frame);
    this.updateDash(frame);
  }

  get drawn(): [boolean, boolean, boolean] {
    return [this.root.visible, this.driverHead?.visible ?? true, this.onboard];
  }

  pose(frame: Float64Array): void {
    this.root.matrix.fromArray(frame, frameIndex.posMat);
    this.root.matrix.elements[14] += this.lift + this.heave;
    this.root.matrix.multiply(this.rollMatrix.makeRotationX(this.roll));
    this.root.matrixWorldNeedsUpdate = true;
    const wheel = (i: number, k: number) =>
      frame[frameIndex.wheels + i * 7 + k] ?? 0;
    const now = performance.now();
    const seconds = THREE.MathUtils.clamp(
      (now - this.posedAt) / 1000,
      shortestFrame,
      longestFrame,
    );
    this.posedAt = now;
    if (!this.offsetReady) {
      this.model.position.x =
        (wheel(0, 0) + wheel(1, 0) + wheel(2, 0) + wheel(3, 0)) / 4 -
        this.visualAxleMid;
      this.model.position.z =
        (wheel(0, 2) + wheel(1, 2) + wheel(2, 2) + wheel(3, 2)) / 4 -
        this.visualWheelHeight;
      this.offsetReady = true;
    }
    this.wheels.forEach((w, i) => {
      w.restZ ??= wheel(i, 2);
      w.pivot.position.set(
        w.rest.x,
        w.rest.y + (wheel(i, 2) - w.restZ) - w.look.sag,
        w.rest.z,
      );
      w.pivot.rotation.set(0, 0, 0);
      w.pivot.rotateY(wheel(i, 5));
      w.pivot.rotateZ(wheel(i, 3));
      w.spin.rotation.set(wheel(i, 4), 0, 0);
      w.look.blur = spinBlur(wheel(i, 6), seconds);
      w.spin.visible = !this.wheelsOff;
    });
    this.updateTyreShadows();
    this.orientTyres();
    this.steeringWheel?.rotation.set(
      0,
      0,
      -(frame[frameIndex.steer] ?? 0) * steeringWheelRotation,
    );
  }

  private updateDash(frame: Float64Array): void {
    if (!this.materials) return;
    const rpm = frame[frameIndex.rpm] ?? 0;
    const redLine = frame[frameIndex.rpmRedLine] ?? 1;
    const rev = THREE.MathUtils.clamp(rpm / Math.max(redLine, 1), 0, 1);
    this.materials.rev.value = Math.max(0, (rev - 0.6) / 0.4);
    this.materials.heat.value =
      [0, 1, 2, 3].reduce(
        (sum, i) => sum + (frame[frameIndex.brakeTemp + i] ?? 0),
        0,
      ) / 4;
    if (!this.onboard) return;
    this.materials.screen.update(frame[frameIndex.time] ?? 0, {
      kph: (frame[frameIndex.speed] ?? 0) * 3.6,
      gear: frame[frameIndex.gear] ?? 0,
      rev,
      lap: frame[frameIndex.laps] ?? 0,
      lapTime: Math.max(frame[frameIndex.curLapTime] ?? 0, 0),
      ...this.dash,
    });
  }
}
