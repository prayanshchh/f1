import {
  BoxGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshBasicNodeMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  type Camera,
  type Material,
  type WebGPURenderer,
} from "three/webgpu";
import { createRenderer } from "../../../apps/client/src/scene/renderer.ts";
import { loadCar, type Car } from "../../../apps/client/src/scene/car/car.ts";
import {
  createCarbon,
  createEnvironment,
  createMetal,
  createPaint,
  createRubber,
} from "../../../apps/client/src/scene/car/materials.ts";
import { MIRROR_GLASS } from "../../../apps/client/src/scene/car/mirrors.ts";
import { parseLivery } from "../../../apps/client/src/livery/index.ts";

type MaterialKind = "paint" | "rubber" | "metal";
type CarView = "chase" | "left-mirror" | "right-mirror";
type BoxSide = "left" | "right" | "none";

export interface CarLab {
  start: () => Promise<void>;
  sphere: (kind: MaterialKind, primary: string) => Promise<void>;
  carbon: (lightAzimuth: number) => Promise<void>;
  car: (view: CarView, box: BoxSide) => Promise<void>;
  setLivery: (file: string) => Promise<void>;
}

declare global {
  interface Window {
    carLab: CarLab;
  }
}

let renderer: WebGPURenderer;
let scene: Scene | undefined;
let camera: Camera | undefined;
let frames = 0;
let car: Car | undefined;

async function waitFrames(): Promise<void> {
  const end = frames + 3;
  await new Promise<void>((resolve) => {
    const check = () => {
      if (frames >= end) resolve();
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
}

async function display(nextScene: Scene, nextCamera: Camera): Promise<void> {
  await renderer.compileAsync(nextScene, nextCamera);
  scene = nextScene;
  camera = nextCamera;
  await waitFrames();
}

function studio(position: [number, number, number]): Scene {
  const result = new Scene();
  result.background = new Color(0x000000);
  result.add(new HemisphereLight(0xd6ecff, 0x35412b, 0.6));
  const sun = new DirectionalLight(0xffffff, 3);
  sun.position.set(...position);
  result.add(sun);
  return result;
}

function sphereMaterial(kind: MaterialKind, primary: string): Material {
  const env = createEnvironment();
  if (kind === "rubber") return createRubber(env);
  if (kind === "metal") return createMetal(env);
  const data = new Uint8ClampedArray(64);
  for (let i = 0; i < data.length; i += 4) data.set([255, 0, 0, 255], i);
  const livery = parseLivery({
    id: "lab",
    name: "Lab",
    primary,
    secondary: "#000000",
    accent: "#ffffff",
    number: 1,
  });
  return createPaint({ width: 4, height: 4, data }, livery, env).material;
}

window.carLab = {
  async start() {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 512;
    canvas.style.cssText = "width:512px;height:512px";
    canvas.dataset["testid"] = "lab-canvas";
    document.body.append(canvas);
    ({ renderer } = await createRenderer(canvas.transferControlToOffscreen(), {
      backend: "webgpu",
      tier: null,
    }));
    renderer.setSize(512, 512, false);
    await renderer.setAnimationLoop(() => {
      if (scene !== undefined && camera !== undefined) {
        renderer.render(scene, camera);
        frames += 1;
      }
    });
  },
  async sphere(kind, primary) {
    const next = studio([-2, 2, 4]);
    next.add(
      new Mesh(new SphereGeometry(1, 128, 64), sphereMaterial(kind, primary)),
    );
    const eye = new PerspectiveCamera(35, 1, 0.1, 20);
    eye.position.set(0, 0, 4);
    eye.lookAt(0, 0, 0);
    await display(next, eye);
  },
  async carbon(azimuth) {
    const tilt = (55 * Math.PI) / 180;
    const next = studio([
      Math.cos(azimuth) * Math.sin(tilt),
      Math.sin(azimuth) * Math.sin(tilt),
      Math.cos(tilt),
    ]);
    next.add(
      new Mesh(new PlaneGeometry(1, 1), createCarbon(createEnvironment(), 16)),
    );
    const eye = new OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 10);
    eye.position.set(0, 0, 2);
    await display(next, eye);
  },
  async car(view, box) {
    car ??= await loadCar(
      {
        model: "/__car/lod3.glb",
        mask: "/__car/livery-mask.png",
        livery: "/__car/liveries/ember.json",
      },
      "low",
    );
    const next = new Scene();
    next.background = new Color(0x000000);
    next.add(new HemisphereLight(0xd6ecff, 0x35412b, 2.4));
    const sun = new DirectionalLight(0xffe5bd, 4);
    sun.position.set(-3, 8, -4);
    next.add(sun, car.root);
    if (box !== "none") {
      const marker = new Mesh(
        new BoxGeometry(2, 2, 1),
        new MeshBasicNodeMaterial({ color: 0xff00ff }),
      );
      marker.position.set(box === "left" ? 5 : -5, 1, -12);
      next.add(marker);
    }
    const eye = new PerspectiveCamera(40, 1, 0.02, 500);
    if (view === "chase") {
      eye.position.set(5, 3.4, -7);
      eye.lookAt(0, 0.45, 0);
    } else {
      const x = (view === "left-mirror" ? 1 : -1) * MIRROR_GLASS.x;
      eye.position.set(x, 0.66, 0.45);
      eye.lookAt(x, MIRROR_GLASS.y, MIRROR_GLASS.z);
    }
    await display(next, eye);
  },
  async setLivery(file) {
    if (car === undefined)
      throw new Error("load the car before changing its livery");
    const response = await fetch(`/__car/liveries/${file}`);
    if (!response.ok)
      throw new Error(
        `could not load lab livery: HTTP ${String(response.status)}`,
      );
    car.setLivery(parseLivery(await response.json()));
    await waitFrames();
  },
};
