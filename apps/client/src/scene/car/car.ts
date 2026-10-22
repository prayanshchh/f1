import { Group, Mesh, type Material } from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { parseLivery, type Livery } from "../../livery/index.ts";
import type { Tier } from "../protocol.ts";
import { decodeMask } from "./mask.ts";
import {
  createCarbon,
  createEnvironment,
  createInterior,
  createMetal,
  createPaint,
  createRubber,
} from "./materials.ts";
import { createMirrors } from "./mirrors.ts";

interface CarAssets {
  model: string;
  mask: string;
  livery: string;
}

export interface Car {
  root: Group;
  mirrors: readonly Mesh[];
  setLivery: (livery: Livery) => void;
}

async function loadLivery(url: string): Promise<Livery> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `could not load the livery ${url}: HTTP ${String(response.status)}`,
    );
  }
  return parseLivery(await response.json());
}

function replaceMaterials(
  root: Group,
  materials: Record<string, Material>,
): void {
  const originals = new Set<Material>();
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const previous: Material | Material[] = (object as Mesh).material;
    if (Array.isArray(previous)) {
      throw new Error("car primitives must have a single material");
    }
    const replacement = materials[previous.name];
    if (replacement === undefined) {
      throw new Error(`unknown car material: ${previous.name}`);
    }
    originals.add(previous);
    object.material = replacement;
  });
  for (const material of originals) material.dispose();
}

export async function loadCar(assets: CarAssets, tier: Tier): Promise<Car> {
  const [gltf, mask, livery] = await Promise.all([
    new GLTFLoader().loadAsync(assets.model),
    decodeMask(assets.mask),
    loadLivery(assets.livery),
  ]);
  const environment = createEnvironment();
  const paint = createPaint(mask, livery, environment);
  replaceMaterials(gltf.scene, {
    livery: paint.material,
    carbon: createCarbon(environment),
    rubber: createRubber(environment),
    rim: createMetal(environment),
    interior: createInterior(environment),
  });
  const root = new Group();
  root.name = "car";
  root.add(gltf.scene);
  return {
    root,
    mirrors: createMirrors(root, tier),
    setLivery: (next) => {
      paint.setLivery(next);
    },
  };
}
