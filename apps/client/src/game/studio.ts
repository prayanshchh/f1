import * as THREE from "three/webgpu";
import {
  abs,
  add,
  clamp,
  float,
  length,
  mix,
  mul,
  positionWorld,
  pow,
  screenUV,
  sin,
  smoothstep,
  sub,
  time,
  vec3,
} from "three/tsl";
import { type CarEnvironment, carEnvironment } from "./carpaint.ts";
import { finishAll, renderDisplay } from "./display.ts";
import { GltfCar, gltfToSdCar } from "./gltf.ts";
import { teamModel } from "./grid.ts";
import { downloadsFromNow } from "./preload.ts";
import { teams } from "./teams.ts";

const hiResDelayMs = 350;
const studioCompound = 1;
const fov = 24;
const domeRadius = 300;
const floorSize = 400;
const floorOpacity = 0.86;
const framingEase = 2.4;
const slideEase = 7;
const slideDistance = 2.6;

export interface StudioFraming {
  eye: [number, number, number];
  target: [number, number, number];
  shiftX: number;
  shiftY: number;
}

export const framings = {
  empty: { eye: [10, 0, 1], target: [0, 0, 0.6], shiftX: 0, shiftY: 0 },
  team: {
    eye: [7.5, 0.12, 1.0],
    target: [0.3, 0, 0.42],
    shiftX: 0.17,
    shiftY: 0.002,
  },
  confirm: {
    eye: [6.9, 5.2, 1.9],
    target: [0, 0, 0.42],
    shiftX: -0.2,
    shiftY: -0.03,
  },
  hub: {
    eye: [8.2, -7.1, 2.1],
    target: [0, 0, 0.42],
    shiftX: -0.2,
    shiftY: -0.02,
  },
} satisfies Record<string, StudioFraming>;

const flowColours = {
  shadow: vec3(0.035, 0.008, 0.016),
  deep: vec3(0.27, 0.02, 0.07),
  crimson: vec3(0.72, 0.09, 0.2),
  rose: vec3(0.93, 0.42, 0.47),
  light: vec3(1.0, 0.86, 0.86),
};

function streaks(v: THREE.Node<"float">, u: THREE.Node<"float">) {
  const drift = time.mul(0.03);
  const spread = u.mul(u).add(0.05).sqrt();
  const warp = sin(u.mul(1.7).add(drift))
    .mul(0.05)
    .add(sin(u.mul(3.3).sub(drift.mul(0.7))).mul(0.018));
  const fan = v.add(warp).div(spread.mul(0.85).add(0.32));
  const band = (frequency: number, phase: number, power: number) =>
    pow(sin(fan.mul(frequency).add(phase)).mul(0.5).add(0.5), float(power));
  const wide = band(5.5, 0.6, 1.6);
  const mid = band(13, 1.7, 3);
  const fine = band(29, 0.9, 7);
  const glints = band(71, 2.3, 22);
  const reach = smoothstep(0.02, 0.8, spread);
  const body = mix(flowColours.deep, flowColours.crimson, wide);
  const rose = mix(
    body,
    flowColours.rose,
    mid.mul(0.8).mul(reach.mul(0.55).add(0.45)),
  );
  return mix(
    rose,
    flowColours.light,
    clamp(
      add(mul(fine, 0.55), mul(glints, 0.75)).mul(reach.mul(0.8).add(0.2)),
      0,
      1,
    ),
  );
}

function backdrop() {
  const u = screenUV.x.mul(2).sub(1);
  const v = float(0.5).sub(screenUV.y);
  const lit = streaks(v.mul(1.15).sub(0.1), u);
  const crown = smoothstep(0.12, 0.42, v.sub(u.mul(u).mul(0.13)).sub(0.13));
  const horizonBand = smoothstep(0.015, 0.14, abs(v.add(0.1)));
  const below = smoothstep(-0.08, -0.26, v);
  const floorTone = mix(flowColours.deep.mul(0.75), flowColours.shadow, below);
  const sky = mix(lit, flowColours.shadow, crown);
  const shaded = mix(flowColours.shadow, sky, horizonBand.mul(0.92).add(0.08));
  return mix(shaded, floorTone, smoothstep(-0.085, -0.13, v));
}

function floorColour() {
  const depth = clamp(screenUV.y.sub(0.56).mul(2.3), 0, 1);
  const glow = sub(1, length(positionWorld.xy).div(16)).clamp(0, 1);
  const base = mix(
    flowColours.crimson.mul(0.62),
    flowColours.deep.mul(0.22),
    depth,
  );
  return base.add(flowColours.rose.mul(glow.mul(glow).mul(0.2)));
}

function floorOpacityNode() {
  const reach = smoothstep(46, 12, length(positionWorld.xy));
  return reach.mul(floorOpacity);
}

function surfaceMaterial(
  colorNode: THREE.Node<"vec3">,
  options: THREE.MeshBasicNodeMaterialParameters = {},
): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial(options);
  material.colorNode = colorNode;
  return material;
}

interface Hero {
  team: string;
  car: GltfCar;
}

export class Studio {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 900);
  private readonly stand = new THREE.Group();
  private readonly lods = new Map<string, THREE.Object3D>();
  private readonly mirrored = new Map<string, THREE.Object3D>();
  private readonly env: CarEnvironment;
  private hero: Hero | null = null;
  private selected = "";
  private request = 0;
  private timer = 0;
  private running = false;
  private framing: StudioFraming = framings.empty;
  private readonly eye = new THREE.Vector3(...framings.empty.eye);
  private readonly target = new THREE.Vector3(...framings.empty.target);
  private shift = { x: 0, y: 0 };
  private slide = 0;
  private lastFrame = 0;
  private lodsReady: Promise<void> | null = null;
  private teamsShare: () => number = () => 0;
  private showCar = false;

  constructor(private readonly renderer: THREE.WebGPURenderer) {
    this.env = carEnvironment(renderer);
    this.camera.up.set(0, 0, 1);
    this.scene.add(this.stand, ...this.stage(), ...this.lights());
    this.stand.visible = false;
  }

  private stage(): THREE.Object3D[] {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(domeRadius, 32, 16),
      surfaceMaterial(backdrop(), { side: THREE.BackSide, depthWrite: false }),
    );
    dome.renderOrder = -10;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(floorSize, floorSize),
      surfaceMaterial(floorColour(), {
        transparent: true,
        depthWrite: false,
      }),
    );
    floor.material.opacityNode = floorOpacityNode();
    floor.renderOrder = -1;
    return [dome, floor];
  }

  private lights(): THREE.Object3D[] {
    const sky = new THREE.HemisphereLight(0xfff4f4, 0x3a0a14, 1.6);
    sky.position.set(0, 0, 1);
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(6, 2, 7);
    const fill = new THREE.DirectionalLight(0xffc4cc, 1.5);
    fill.position.set(8, -5, 2);
    const rim = new THREE.DirectionalLight(0xff4d6d, 2.2);
    rim.position.set(-7, 4, 3);
    return [sky, key, fill, rim];
  }

  preloadTeams(): Promise<void> {
    if (!this.lodsReady) this.teamsShare = downloadsFromNow();
    this.lodsReady ??= Promise.all(
      teams.map(async (team) => {
        const model = await teamModel(team.id, this.env).catch(() => null);
        if (!model) return;
        finishAll(model);
        this.lods.set(team.id, this.placed(model, 1));
        this.mirrored.set(team.id, this.placed(model.clone(), -1));
      }),
    ).then(() => undefined);
    return this.lodsReady;
  }

  teamsLoaded(): number {
    return this.teamsShare();
  }

  private placed(model: THREE.Object3D, scaleZ: number): THREE.Object3D {
    const axes = new THREE.Group();
    axes.matrixAutoUpdate = false;
    axes.matrix.copy(gltfToSdCar);
    axes.add(model);
    const holder = new THREE.Group();
    holder.scale.z = scaleZ;
    holder.add(axes);
    return holder;
  }

  frame(framing: StudioFraming): void {
    this.framing = framing;
  }

  async select(team: string, enter = true): Promise<void> {
    await this.preloadTeams();
    this.showCar = true;
    if (team === this.selected) return;
    this.selected = team;
    this.request += 1;
    const request = this.request;
    window.clearTimeout(this.timer);
    this.dropHero();
    this.mountLod(team);
    if (enter) this.slide = 1;
    this.timer = window.setTimeout(() => {
      this.mountHero(team, request).catch(() => undefined);
    }, hiResDelayMs);
  }

  hideCar(): void {
    this.showCar = false;
  }

  private mountLod(team: string): void {
    this.stand.clear();
    const lod = this.lods.get(team);
    const reflection = this.mirrored.get(team);
    if (lod) this.stand.add(lod);
    if (reflection) this.stand.add(reflection);
  }

  private async mountHero(team: string, request: number): Promise<void> {
    const car = await GltfCar.load(team, this.renderer, this.env);
    if (request !== this.request) {
      car.dispose();
      return;
    }
    this.dropHero();
    this.hero = { team, car };
    const lod = this.lods.get(team);
    if (lod) this.stand.remove(lod);
    car.root.matrixAutoUpdate = true;
    car.setDraw(true, true, true);
    finishAll(car.root);
    car.setCompound(studioCompound);
    this.stand.add(car.root);
  }

  private dropHero(): void {
    if (!this.hero) return;
    this.stand.remove(this.hero.car.root);
    this.hero.car.dispose();
    this.hero = null;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.resize();
    window.addEventListener("resize", this.resize);
    this.lastFrame = performance.now();
    void this.renderer.setAnimationLoop(() => {
      this.draw();
    });
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    window.removeEventListener("resize", this.resize);
    void this.renderer.setAnimationLoop(null);
  }

  private readonly resize = (): void => {
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };

  private ease(dt: number): void {
    const blend = 1 - Math.exp(-framingEase * dt);
    this.eye.lerp(new THREE.Vector3(...this.framing.eye), blend);
    this.target.lerp(new THREE.Vector3(...this.framing.target), blend);
    this.shift.x += (this.framing.shiftX - this.shift.x) * blend;
    this.shift.y += (this.framing.shiftY - this.shift.y) * blend;
    this.slide *= Math.exp(-slideEase * dt);
  }

  private draw(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.ease(dt);
    this.stand.visible = this.showCar;
    this.stand.position.y = this.slide * slideDistance;
    const sway = Math.sin(now / 5200) * 0.12;
    this.camera.position.copy(this.eye).add(new THREE.Vector3(0, sway, 0));
    this.camera.lookAt(this.target);
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    this.camera.setViewOffset(
      width,
      height,
      this.shift.x * width,
      this.shift.y * height,
      width,
      height,
    );
    this.hero?.car.renderAuxiliary(this.renderer, this.scene);
    renderDisplay(this.renderer, this.scene, this.camera);
  }

  dispose(): void {
    this.stop();
    window.clearTimeout(this.timer);
    this.request += 1;
    this.dropHero();
    this.stand.clear();
    const seen = new Set<unknown>();
    const release = (resource: { dispose: () => void }) => {
      if (seen.has(resource)) return;
      seen.add(resource);
      resource.dispose();
    };
    for (const model of this.lods.values())
      model.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        release(object.geometry as THREE.BufferGeometry);
        const material = object.material as THREE.MeshStandardMaterial;
        if (material.map) release(material.map);
        release(material);
      });
    this.lods.clear();
    this.mirrored.clear();
    this.env.texture.dispose();
  }
}
