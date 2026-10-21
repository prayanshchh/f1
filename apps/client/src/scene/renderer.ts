import { ACESFilmicToneMapping, WebGPURenderer } from "three/webgpu";
import type { Backend, SceneOptions, Tier } from "./protocol.ts";

function qualityTier(
  backend: Backend,
  options: SceneOptions,
  software: boolean,
): Tier {
  if (backend === "webgl2") {
    return "basic";
  }
  return options.tier ?? (software ? "low" : "high");
}

export async function createRenderer(
  canvas: OffscreenCanvas,
  options: SceneOptions,
): Promise<{
  renderer: WebGPURenderer;
  backend: Backend;
  tier: Tier;
  timestamps: boolean;
}> {
  const adapter =
    options.backend === "webgpu" && "gpu" in navigator
      ? await navigator.gpu.requestAdapter()
      : null;
  const backend = adapter === null ? "webgl2" : "webgpu";
  const tier = qualityTier(
    backend,
    options,
    adapter?.info.isFallbackAdapter === true,
  );
  const timestamps = adapter?.features.has("timestamp-query") === true;
  const device = await adapter?.requestDevice({
    requiredFeatures: (
      ["timestamp-query", "core-features-and-limits"] as const
    ).filter((feature) => adapter.features.has(feature)),
  });
  const renderer = new WebGPURenderer({
    canvas,
    device,
    forceWebGL: backend === "webgl2",
    antialias: tier === "high" || tier === "ultra",
    trackTimestamp: timestamps,
    alpha: false,
  });
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  await renderer.init();
  return { renderer, backend, tier, timestamps };
}
