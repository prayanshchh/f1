export interface Counters {
  pipelines: number;
  buffers: number;
}

declare global {
  interface Window {
    gpuCounters: Counters;
  }
}

export function countGpuObjects(): void {
  const counters: Counters = { pipelines: 0, buffers: 0 };
  Object.defineProperty(window, "gpuCounters", { value: counters });
  const count = (method: "createRenderPipeline" | "createBuffer") => {
    const original = Object.getOwnPropertyDescriptor(
      GPUDevice.prototype,
      method,
    )?.value as (...args: unknown[]) => unknown;
    Object.defineProperty(GPUDevice.prototype, method, {
      value(this: GPUDevice, ...args: unknown[]) {
        if (method === "createBuffer") counters.buffers += 1;
        else counters.pipelines += 1;
        return original.apply(this, args);
      },
    });
  };
  count("createRenderPipeline");
  count("createBuffer");
}
