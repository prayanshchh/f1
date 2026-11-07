import * as THREE from "three/webgpu";
import createCorridor, { type CorridorModule } from "../../../wasm/corridor.js";
import type {
  ImageJob,
  ImageResult,
  TrackJob,
  TrackResult,
} from "./loader-worker.ts";
import { type PresentSetup, shownSlot, shownWords } from "./shown.ts";
import { fileBlob, fileJson, lowFile } from "./corridor-files.ts";
import { type TrackManifest, type TrackPart, TrackSet } from "./track-set.ts";

export interface MeshData {
  positions: Float32Array;
  uvs: Float32Array | null;
  indices: Uint32Array;
}

export interface Placed {
  mesh: number;
  matrix: THREE.Matrix4;
  last: boolean;
}

export interface Lighting {
  sun: THREE.Vector3;
  sunColour: THREE.Color;
  sky: THREE.Color;
  ground: THREE.Color;
}

const maxLines = 2200;
const layerBias: Record<string, number> = { ground: 0.996, decal: 1.003 };
const minLines = 540;
const frameBudget = 1000 / 120;
const raiseShare = 1;
const lowerShare = 0.7;
const deliveredFloor = 0.75;
const adaptFrames = 120;
const settleWindows = 3;
const lowerWindows = 3;
const raiseWindows = 5;
const near = 0.25;
const far = 40000;
const maxMatrices = 2048;
const groundFrom = 0.004;
const groundFade = 0.05;
const maxList = 8192;
const trackFile = "toon.bin";
const manifestFile = "manifest.json";

function maybeBlob(url: string | null): Promise<Blob | null> {
  return url === null ? Promise.resolve(null) : fileBlob(url);
}

function percentile(values: number[], share: number): number {
  values.sort((a, b) => a - b);
  return values[Math.floor((values.length - 1) * share)] ?? 0;
}

export class CorridorView {
  readonly canvas = document.createElement("canvas");
  private readonly presenter = new Worker(
    new URL("./present-worker.ts", import.meta.url),
    { type: "module" },
  );
  private readonly control: number;
  private collected = 0;
  private width = 0;
  private height = 0;
  private coarse = 0;
  private readonly recent: number[] = [];
  private readonly rasters: number[] = [];
  private windows = 0;
  private ticks = 0;
  private slowRun = 0;
  private fastRun = 0;
  private readonly worker = new Worker(
    new URL("./loader-worker.ts", import.meta.url),
    { type: "module" },
  );
  private nextJob = 1;
  private readonly waiting = new Map<
    number,
    { resolve: (value: TrackResult | ImageResult) => void }
  >();
  private readonly shared = new Map<string, number>();
  private track: TrackSet | null = null;
  private readonly trackList: number[] = [];
  private readonly frustum = new THREE.Frustum();
  private readonly viewProjection = new THREE.Matrix4();
  private readonly cameraBuffer: number;
  private readonly listBuffer: number;
  private readonly matrixBuffer: number;
  private readonly lightBuffer: number;
  private readonly roadInverse = new THREE.Matrix4();
  private readonly local = new THREE.Matrix4();
  private readonly list = new Int32Array(maxList * 2);
  private readonly matrices = new Float32Array(maxMatrices * 16);
  presented = 0;
  private renderStarted = 0;
  readonly timings: {
    render: number;
    raster: number;
    triangles: number;
    present: number;
    lines: number;
  }[] = [];

  private constructor(
    private readonly module: CorridorModule,
    private readonly manifest: TrackManifest,
  ) {
    this.canvas.className = "corridor-canvas";
    this.control = module._cr_shown();
    const offscreen = this.canvas.transferControlToOffscreen();
    this.presenter.postMessage(
      {
        memory: module.wasmMemory,
        control: this.control,
        canvas: offscreen,
      } satisfies PresentSetup,
      [offscreen],
    );
    this.cameraBuffer = module._malloc(25 * 4);
    this.listBuffer = module._malloc(maxList * 2 * 4);
    this.matrixBuffer = module._malloc(maxMatrices * 16 * 4);
    this.lightBuffer = module._malloc(32 * 4);
    const [r = 0, g = 0, b = 0] = manifest.ground;
    module._cr_ground(r, g, b, groundFrom, groundFade);
    const [zr = 0, zg = 0, zb = 0] = manifest.sky.zenith;
    const [hr = 0, hg = 0, hb = 0] = manifest.sky.horizon;
    module._cr_sky(zr, zg, zb, hr, hg, hb);
    this.worker.onmessage = (
      event: MessageEvent<TrackResult | ImageResult>,
    ) => {
      const job = this.waiting.get(event.data.id);
      this.waiting.delete(event.data.id);
      job?.resolve(event.data);
    };
  }

  static async load(threads: number): Promise<CorridorView> {
    const [module, manifest] = await Promise.all([
      createCorridor(),
      fileJson<TrackManifest>(lowFile(manifestFile)),
    ]);
    module._cr_init(threads);
    const view = new CorridorView(module, manifest);
    try {
      await view.loadShared();
      await view.loadTrack();
    } catch (error) {
      view.dispose();
      throw error;
    }
    return view;
  }

  dispose(): void {
    this.module.PThread.terminateAllThreads();
    this.worker.terminate();
    this.presenter.terminate();
    this.canvas.remove();
  }

  get memory(): WebAssembly.Memory {
    return this.module.wasmMemory;
  }

  private heap(): Uint8Array {
    return new Uint8Array(this.module.wasmMemory.buffer);
  }

  private copyIn(data: ArrayBufferView): number {
    const pointer = this.module._malloc(data.byteLength);
    this.heap().set(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      pointer,
    );
    return pointer;
  }

  private post(
    job: TrackJob | Omit<ImageJob, "memory">,
  ): Promise<TrackResult | ImageResult> {
    return new Promise((resolve) => {
      this.waiting.set(job.id, { resolve });
      this.worker.postMessage(
        job.kind === "image" ? { ...job, memory: this.module.wasmMemory } : job,
      );
    });
  }

  async texture(
    url: string,
    width: number,
    height: number,
    flags: number,
    alpha: string | null = null,
    shade: string | null = null,
  ): Promise<number> {
    const [colour, cutout, carbon] = await Promise.all([
      fileBlob(url),
      maybeBlob(alpha),
      maybeBlob(shade),
    ]);
    const pointer = this.module._malloc(width * height * 4);
    const result = await this.post({
      kind: "image",
      id: this.nextJob++,
      colour,
      alpha: cutout,
      shade: carbon,
      posterize: 0,
      pointer,
      width,
      height,
    });
    if (result.error) {
      this.module._free(pointer);
      throw new Error(result.error);
    }
    return this.module._cr_texture_async(pointer, width, height, flags);
  }

  async swatch(
    url: string,
    shade: string,
    size: number,
    colours: number,
  ): Promise<Uint8Array> {
    const [colour, carbon] = await Promise.all([
      fileBlob(url),
      fileBlob(shade),
    ]);
    const pointer = this.module._malloc(size * size * 4);
    try {
      const result = await this.post({
        kind: "image",
        id: this.nextJob++,
        colour,
        alpha: null,
        shade: carbon,
        posterize: colours,
        pointer,
        width: size,
        height: size,
      });
      if (result.error) throw new Error(result.error);
      return this.heap().slice(pointer, pointer + size * size * 4);
    } finally {
      this.module._free(pointer);
    }
  }

  rawTexture(
    pixels: Uint8Array,
    width: number,
    height: number,
    flags: number,
  ): number {
    const pointer = this.copyIn(pixels);
    const id = this.module._cr_texture(pointer, width, height, flags);
    this.module._free(pointer);
    return id;
  }

  solidTexture(colour: THREE.Color): number {
    const key = `#${colour.getHexString(THREE.SRGBColorSpace)}`;
    const known = this.shared.get(key);
    if (known !== undefined) return known;
    const srgb = colour.clone().convertLinearToSRGB();
    const pixel = new Uint8Array([
      Math.round(srgb.r * 255),
      Math.round(srgb.g * 255),
      Math.round(srgb.b * 255),
      255,
    ]);
    const id = this.rawTexture(pixel, 1, 1, 0);
    this.shared.set(key, id);
    return id;
  }

  mesh(
    data: MeshData,
    texture: number,
    normals: Float32Array | null = null,
    tint: readonly number[] = [1, 1, 1],
    colours: Uint32Array | null = null,
  ): number {
    const pointers = [
      data.positions,
      normals,
      data.uvs,
      colours,
      data.indices,
    ].map((part) => (part ? this.copyIn(part) : 0));
    const at = (i: number): number => pointers[i] ?? 0;
    const shade = (i: number): number => tint[i] ?? 1;
    const id = this.module._cr_mesh(
      at(0),
      at(1),
      at(2),
      at(3),
      at(4),
      data.positions.length / 3,
      data.indices.length,
      texture,
      shade(0),
      shade(1),
      shade(2),
    );
    for (const pointer of pointers) if (pointer) this.module._free(pointer);
    return id;
  }

  cull(mesh: number): void {
    this.module._cr_mesh_cull(mesh, 1);
  }

  layer(mesh: number, layer: string | null): void {
    const bias = layer ? layerBias[layer] : undefined;
    if (bias) this.module._cr_mesh_bias(mesh, bias);
  }

  private async loadShared(): Promise<void> {
    const { textures, patterns } = this.manifest;
    for (const [name, pattern] of Object.entries(patterns)) {
      const pixels = new Uint8Array(
        pattern.colours.flatMap(([r = 0, g = 0, b = 0]) => [r, g, b, 255]),
      );
      this.shared.set(
        name,
        this.rawTexture(pixels, 1, pattern.colours.length, pattern.flags),
      );
    }
    await Promise.all(
      Object.entries(textures).map(async ([name, info]) => {
        const id = await this.texture(
          lowFile(info.file),
          info.width,
          info.height,
          info.flags,
          info.alpha ? lowFile(info.alpha) : null,
        );
        this.shared.set(name, id);
      }),
    );
  }

  private async loadTrack(): Promise<void> {
    const result = (await this.post({
      kind: "track",
      id: this.nextJob++,
      data: await fileBlob(lowFile(trackFile)),
      millimetre: this.manifest.millimetre,
    })) as TrackResult;
    if (result.error) throw new Error(result.error);
    const parts: TrackPart[] = result.groups.map((group, index) => {
      const spec = this.manifest.groups[index];
      const material = this.manifest.materials[spec?.material ?? 0];
      const texture = material?.texture
        ? (this.shared.get(material.texture) ?? -1)
        : -1;
      const make = (indices: Uint32Array) => {
        const id = this.mesh(
          {
            positions: group.positions,
            uvs: texture >= 0 ? group.uvs : null,
            indices,
          },
          texture,
          null,
          [1, 1, 1],
          texture >= 0 ? null : group.colours,
        );
        this.layer(id, material?.layer ?? null);
        return id;
      };
      const near = make(group.near);
      return {
        near,
        far: group.far ? make(group.far) : near,
      };
    });
    this.track = new TrackSet(this.manifest, parts);
  }

  async ready(): Promise<void> {
    const textures = [...this.shared.values()];
    while (!textures.every((id) => this.module._cr_texture_ready(id) === 1))
      await new Promise((resolve) => setTimeout(resolve, 50));
  }

  private count = 0;
  private matrixCount = 0;

  private place(car: Placed): void {
    if (this.count >= maxList || this.matrixCount >= maxMatrices) return;
    this.local.multiplyMatrices(this.roadInverse, car.matrix);
    this.matrices.set(this.local.elements, this.matrixCount * 16);
    this.list[this.count * 2] = car.mesh;
    this.list[this.count * 2 + 1] = this.matrixCount++;
    this.count++;
  }

  private push(mesh: number): void {
    if (mesh < 0 || this.count >= maxList) return;
    this.list[this.count * 2] = mesh;
    this.list[this.count * 2 + 1] = -1;
    this.count++;
  }

  private drawList(cars: Placed[], camera: THREE.PerspectiveCamera): void {
    this.count = 0;
    this.matrixCount = 0;
    this.local.multiplyMatrices(this.roadInverse, camera.matrixWorld);
    const eye = new THREE.Vector3().setFromMatrixPosition(this.local);
    this.viewProjection.multiplyMatrices(
      camera.projectionMatrix,
      this.local.invert(),
    );
    this.frustum.setFromProjectionMatrix(this.viewProjection);
    for (const car of cars) if (!car.last) this.place(car);
    this.trackList.length = 0;
    this.track?.visible(this.frustum, eye, this.trackList);
    for (const id of this.trackList) this.push(id);
    for (const car of cars) if (car.last) this.place(car);
  }

  private screenLines(): number {
    return window.innerHeight * window.devicePixelRatio;
  }

  private divisor(): number {
    return Math.max(1, Math.ceil(this.screenLines() / maxLines)) + this.coarse;
  }

  private adapt(render: number, raster: number): void {
    this.recent.push(render);
    this.rasters.push(raster);
    if (this.recent.length < adaptFrames) return;
    const slow = percentile(this.recent, 0.9);
    const fill = percentile(this.rasters, 0.9);
    this.recent.length = 0;
    this.rasters.length = 0;
    const delivered = adaptFrames / Math.max(adaptFrames, this.ticks);
    this.ticks = 0;
    if (++this.windows > settleWindows) this.judge(slow, fill, delivered);
  }

  private judge(slow: number, fill: number, delivered: number): void {
    const divisor = this.divisor();
    const predicted = slow - fill + fill * (divisor / (divisor - 1)) ** 2;
    const coarser = this.screenLines() / (divisor + 1) >= minLines;
    const dropping =
      delivered < deliveredFloor && slow > frameBudget * lowerShare;
    this.slowRun = dropping ? this.slowRun + 1 : 0;
    this.fastRun =
      this.coarse > 0 && predicted < frameBudget * raiseShare
        ? this.fastRun + 1
        : 0;
    if (this.slowRun >= lowerWindows && coarser) {
      this.coarse++;
      this.slowRun = 0;
    } else if (this.fastRun >= raiseWindows) {
      this.coarse--;
      this.fastRun = 0;
    }
  }

  private resize(): void {
    const divisor = this.divisor();
    const ratio = window.devicePixelRatio / divisor;
    const width = Math.max(4, Math.round(window.innerWidth * ratio));
    const height = Math.max(4, Math.round(window.innerHeight * ratio));
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.module._cr_resize(width, height);
  }

  private cameraData(camera: THREE.PerspectiveCamera): Float32Array {
    this.local.multiplyMatrices(this.roadInverse, camera.matrixWorld);
    const e = this.local.elements;
    const rx = new THREE.Vector3(e[0], e[1], e[2]).normalize();
    const ry = new THREE.Vector3(e[4], e[5], e[6]).normalize();
    const rz = new THREE.Vector3(e[8], e[9], e[10]).normalize();
    const eye = new THREE.Vector3(e[12], e[13], e[14]);
    const ty = Math.tan((camera.fov * Math.PI) / 360) / camera.zoom;
    const tx = ty * (this.width / this.height);
    const view = new THREE.Matrix4().set(
      rx.x,
      rx.y,
      rx.z,
      -rx.dot(eye),
      ry.x,
      ry.y,
      ry.z,
      -ry.dot(eye),
      rz.x,
      rz.y,
      rz.z,
      -rz.dot(eye),
      0,
      0,
      0,
      1,
    );
    const projection = new THREE.Matrix4().set(
      1 / tx,
      0,
      0,
      0,
      0,
      1 / ty,
      0,
      0,
      0,
      0,
      -(far + near) / (far - near),
      (-2 * far * near) / (far - near),
      0,
      0,
      -1,
      0,
    );
    const vp = projection.multiply(view);
    const forward = rz.clone().negate();
    const corner = forward
      .clone()
      .addScaledVector(rx, -tx)
      .addScaledVector(ry, ty);
    const right = rx.clone().multiplyScalar((2 * tx) / this.width);
    const down = ry.clone().multiplyScalar((-2 * ty) / this.height);
    return new Float32Array([
      ...vp.elements,
      ...corner.toArray(),
      ...right.toArray(),
      ...down.toArray(),
    ]);
  }

  private lightData(light: Lighting): Float32Array {
    const sun = light.sun.clone().transformDirection(this.roadInverse);
    return new Float32Array([
      ...sun.toArray(),
      light.sunColour.r,
      light.sunColour.g,
      light.sunColour.b,
      light.sky.r,
      light.sky.g,
      light.sky.b,
      light.ground.r,
      light.ground.g,
      light.ground.b,
    ]);
  }

  busy(): boolean {
    return this.module._cr_busy() !== 0;
  }

  private shownWords(): Int32Array {
    return new Int32Array(
      this.module.wasmMemory.buffer,
      this.control,
      shownWords,
    );
  }

  settled(): boolean {
    const shown = this.shownWords();
    return (
      !this.busy() &&
      Atomics.load(shown, shownSlot.seen) ===
        Atomics.load(shown, shownSlot.frame)
    );
  }

  collect(): boolean {
    this.ticks++;
    const seen = Atomics.load(this.shownWords(), shownSlot.seen);
    if (seen === this.collected) return false;
    this.collected = seen;
    const render = this.module._cr_frame_ms();
    const raster = this.module._cr_raster_ms();
    this.adapt(render, raster);
    this.timings.push({
      render,
      raster,
      triangles: this.module._cr_triangles(),
      lines: this.height,
      present:
        new Float32Array(
          this.module.wasmMemory.buffer,
          this.control,
          shownWords,
        )[shownSlot.presentMs] ?? 0,
    });
    this.presented++;
    if (this.timings.length > 4000) this.timings.splice(0, 2000);
    return true;
  }

  render(
    trackMatrix: THREE.Matrix4,
    camera: THREE.PerspectiveCamera,
    cars: Placed[],
    light: Lighting,
  ): boolean {
    if (this.busy()) return false;
    this.roadInverse.copy(trackMatrix).invert();
    this.resize();
    this.drawList(cars, camera);
    const { count, matrixCount: matrices } = this;
    const heap = new Float32Array(this.module.wasmMemory.buffer);
    heap.set(this.cameraData(camera), this.cameraBuffer / 4);
    heap.set(this.lightData(light), this.lightBuffer / 4);
    heap.set(this.matrices.subarray(0, matrices * 16), this.matrixBuffer / 4);
    new Int32Array(this.module.wasmMemory.buffer).set(
      this.list.subarray(0, count * 2),
      this.listBuffer / 4,
    );
    this.renderStarted = performance.now();
    return (
      this.module._cr_submit(
        this.cameraBuffer,
        this.listBuffer,
        count,
        this.matrixBuffer,
        matrices,
        this.lightBuffer,
      ) === 1
    );
  }

  stats(): {
    triangles: number;
    shaded: number;
    rasterMs: number;
    transformMs: number;
    frameMs: number;
  } {
    return {
      triangles: this.module._cr_triangles(),
      shaded: this.module._cr_shaded(),
      rasterMs: this.module._cr_raster_ms(),
      transformMs: this.module._cr_transform_ms(),
      frameMs: this.module._cr_frame_ms(),
    };
  }

  get startedAt(): number {
    return this.renderStarted;
  }
}
