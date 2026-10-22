import type { TrackData } from "../contracts/index.ts";
export const cameras = ["chase", "cockpit", "tv"] as const;
export type Camera = (typeof cameras)[number];

const tiers = ["ultra", "high", "medium", "low", "basic"] as const;
export type Tier = (typeof tiers)[number];
export type Backend = "webgpu" | "webgl2";

export interface SceneOptions {
  backend: Backend;
  tier: Tier | null;
}

export function sceneOptions(query: string): SceneOptions {
  const parameters = new URLSearchParams(query);
  const backend = parameters.get("backend") ?? "webgpu";
  const tier = parameters.get("tier");
  if (backend !== "webgpu" && backend !== "webgl2") {
    throw new Error(`Unknown backend: ${backend}. Choose webgpu or webgl2.`);
  }
  if (tier !== null && !tiers.some((value) => value === tier)) {
    throw new Error(`Unknown tier: ${tier}. Choose ${tiers.join(", ")}.`);
  }
  return { backend, tier: tier as Tier | null };
}

export type SceneRequest =
  | {
      type: "start";
      canvas: OffscreenCanvas;
      options: SceneOptions;
      width: number;
      height: number;
    }
  | { type: "resize"; width: number; height: number }
  | { type: "camera"; camera: Camera }
  | { type: "drive"; track: TrackData; port: MessagePort };

export interface SceneTimings {
  fps: number;
  frames: number;
  frameMs: number;
  gpuMs: number | "unavailable";
  backend: Backend;
  tier: Tier;
  resolution: string;
  meshes: number;
}

export type SceneResponse =
  | { type: "frame"; timings: SceneTimings; camera: Camera }
  | { type: "error"; message: string };
