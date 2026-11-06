import * as THREE from "three/webgpu";
import type { Engine } from "../engine.ts";
import type { Scene } from "../scene.ts";
import { skyIrradiance } from "../sky-ambient.ts";
import { CorridorCars, type TyreWall } from "./corridor-cars.ts";
import { CorridorLine } from "./corridor-line.ts";
import { CorridorView, type Lighting } from "./corridor-view.ts";

const base = "/corridor/";
const acesScale = 1 / 0.6;

export interface CorridorDraw {
  draw: () => void;
  show: (shown: boolean) => void;
  view: CorridorView;
  cars: CorridorCars;
  light: Lighting;
}

export async function corridorDrawer(
  scene: Scene,
  engine: Engine,
  teams: string[],
  gpuCanvas: HTMLCanvasElement,
): Promise<CorridorDraw> {
  const threads = Math.max(2, (navigator.hardwareConcurrency || 4) - 1);
  const view = await CorridorView.load(base, threads);
  const wall = (await (
    await fetch(`${base}tyre-wall.json`)
  ).json()) as TyreWall;
  const cars = await CorridorCars.load(view, teams, scene.carEnvironment, wall);
  const line = new CorridorLine(view, scene.atmosphere.exposure);
  const light: Lighting = {
    sun: new THREE.Vector3(0, 1, 0),
    sunColour: new THREE.Color(),
    sky: new THREE.Color(),
    ground: new THREE.Color(),
  };
  const relight = () => {
    const exposure = scene.atmosphere.exposure * acesScale;
    const ambient = (scene.scene.environmentIntensity * exposure) / Math.PI;
    const { up, down } = skyIrradiance();
    const sun = scene.sunLight;
    light.sun.copy(scene.atmosphere.sunDirection);
    light.sky.copy(up).multiplyScalar(ambient);
    light.ground.copy(down).multiplyScalar(ambient);
    light.sunColour
      .copy(sun.color)
      .multiplyScalar((sun.intensity * exposure) / Math.PI);
  };
  await view.ready();
  Object.assign(view.canvas.style, {
    position: "fixed",
    inset: "0",
    width: "100%",
    height: "100%",
    imageRendering: "pixelated",
  });
  view.canvas.style.visibility = "hidden";
  view.canvas.dataset["testid"] = "corridor-canvas";
  gpuCanvas.after(view.canvas);
  return {
    view,
    cars,
    light,
    show: (shown) => {
      view.canvas.style.visibility = shown ? "visible" : "hidden";
      gpuCanvas.style.visibility = shown ? "hidden" : "visible";
    },
    draw: () => {
      relight();
      const mirror = scene.mirrored ? "scaleX(-1)" : "";
      if (view.canvas.style.transform !== mirror)
        view.canvas.style.transform = mirror;
      view.collect();
      view.render(
        scene.trackMatrix,
        scene.camera,
        [...cars.update(engine.cars(), scene.camera), ...line.update(scene)],
        light,
      );
    },
  };
}
