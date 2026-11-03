import * as THREE from "three/webgpu";
import { pass } from "three/tsl";
import { carStride, frameIndex } from "./frame-layout.ts";
import { putHidden, putText } from "./hud-dom.ts";
import type { ReplayTape } from "./replay.ts";
import { ReplayCamera, type Station } from "./replay-camera.ts";
import type { Scene } from "./scene.ts";

const leadIn = 2.5;
const runOut = 1.5;
const longest = 9;
const shortest = 4;
const linger = 1.5;
const sameIncident = 15;
const insetNear = 0.5;
const insetFar = 350;
const insetSamples = 4;
const drawEvery = 30;
const pixelRatioCap = 2;

interface Clip {
  car: number;
  from: number;
  to: number;
  start: number;
}

function clipWindow(
  at: number,
  since: number,
  tapeStart: number,
): [number, number] {
  const to = at + runOut;
  const from =
    to - Math.min(longest, Math.max(shortest, since + leadIn + runOut));
  return [Math.max(tapeStart, from), to];
}

export class IncidentCam {
  private readonly target: THREE.CanvasTarget;
  private readonly pipeline: THREE.RenderPipeline;
  private readonly camera = new THREE.PerspectiveCamera(
    30,
    16 / 9,
    insetNear,
    insetFar,
  );
  private readonly view: ReplayCamera;
  private readonly frame = new Float64Array(frameIndex.size);
  private readonly cars: Float64Array;
  private readonly frustum = new THREE.Frustum();
  private readonly matrix = new THREE.Matrix4();
  private readonly canvas: HTMLCanvasElement;
  private clip: Clip | null = null;
  private ready = false;
  private fitted = false;
  private aspectUsed = 0;
  private drawnAt = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly renderer: THREE.WebGPURenderer,
    private readonly scene: Scene,
    private readonly tape: ReplayTape,
    stations: Station[],
    trackLength: number,
  ) {
    const canvas = root.querySelector("canvas");
    if (!canvas) throw new Error("incident replay needs a canvas");
    this.canvas = canvas;
    this.target = new THREE.CanvasTarget(canvas);
    this.pipeline = new THREE.RenderPipeline(
      renderer,
      pass(scene.scene, this.camera, { samples: insetSamples }),
    );
    this.view = new ReplayCamera(stations, trackLength);
    this.view.use("heli");
    this.cars = new Float64Array(tape.carCount * carStride);
    this.camera.up.set(0, 0, 1);
    root.hidden = true;
    this.target.setSize(16, 9, false);
    this.draw();
  }

  play(
    car: number,
    at: number,
    since: number,
    title: string,
    detail: string,
  ): void {
    const current = this.clip;
    putText(this.part("title"), title);
    putText(this.part("detail"), detail);
    if (current?.car === car && at - current.start < sameIncident) return;
    const [from, to] = clipWindow(at, since, this.tape.start);
    this.clip = { car, from, to, start: at };
    this.view.follow(car);
    this.fitted = false;
    putHidden(this.root, false);
  }

  prepare(live: Float64Array): void {
    const now = live[frameIndex.time] ?? 0;
    this.ready = false;
    const clip = this.clip;
    if (!clip) return;
    const t = clip.from + (now - clip.start);
    if (now < clip.start || t > clip.to + linger) {
      this.stop();
      return;
    }
    const wall = performance.now();
    const due = wall - this.drawnAt >= drawEvery;
    if (
      !due ||
      !this.tape.sample(Math.min(t, clip.to), this.frame, this.cars)
    ) {
      this.scene.showInset(null);
      return;
    }
    this.drawnAt = wall;
    if (!this.fitted) this.fit();
    this.aim();
    this.scene.showInset(this.frustum);
    this.ready = true;
  }

  render(): void {
    if (!this.ready) return;
    this.ready = false;
    const { scene } = this;
    scene.posePast(this.frame, this.cars, this.camera);
    this.draw();
    scene.posePresent();
  }

  private draw(): void {
    const main = this.renderer.getCanvasTarget();
    this.renderer.setCanvasTarget(this.target);
    this.pipeline.render();
    this.renderer.setCanvasTarget(main);
  }

  stop(): void {
    this.clip = null;
    this.ready = false;
    this.scene.showInset(null);
    putHidden(this.root, true);
  }

  private part(name: string): HTMLElement {
    const node = this.root.querySelector<HTMLElement>(
      `[data-incident=${name}]`,
    );
    if (!node) throw new Error(`incident replay is missing ${name}`);
    return node;
  }

  private fit(): void {
    const box = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(box.width));
    const height = Math.max(1, Math.round(box.height));
    this.target.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatioCap));
    this.target.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.fitted = true;
  }

  private aim(): void {
    const pose = this.view.pose(this.frame, this.cars);
    const { camera } = this;
    camera.position.set(...pose.eye);
    camera.lookAt(...pose.target);
    if (camera.fov !== pose.fov || camera.aspect !== this.aspectUsed) {
      camera.fov = pose.fov;
      camera.updateProjectionMatrix();
      this.aspectUsed = camera.aspect;
    }
    camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(
      this.matrix.multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      ),
      camera.coordinateSystem,
      camera.reversedDepth,
    );
  }
}
