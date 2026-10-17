import "./style.css";

type FailureReason =
  | "webgpu-unsupported"
  | "adapter-unavailable"
  | "device-request-failed"
  | "context-unavailable"
  | "device-lost";

class GpuFailure extends Error {
  constructor(
    readonly reason: FailureReason,
    message: string,
  ) {
    super(message);
  }
}

const canvas = document.querySelector<HTMLCanvasElement>(
  '[data-testid="gpu-canvas"]',
);

function showFailure(error: unknown): void {
  if (document.body.dataset["gpuStatus"] === "error") {
    return;
  }
  document.body.dataset["gpuStatus"] = "error";
  if (canvas !== null) {
    canvas.hidden = true;
  }
  const alert = document.createElement("p");
  alert.dataset["testid"] = "gpu-error";
  alert.dataset["reason"] =
    error instanceof GpuFailure ? error.reason : "context-unavailable";
  alert.setAttribute("role", "alert");
  alert.textContent =
    error instanceof Error ? error.message : "WebGPU could not draw the page.";
  document.body.append(alert);
}

async function requestDevice(): Promise<GPUDevice> {
  if (!("gpu" in navigator)) {
    throw new GpuFailure(
      "webgpu-unsupported",
      "WebGPU is unavailable. Open this page in Google Chrome with WebGPU enabled.",
    );
  }
  let adapter: GPUAdapter | null;
  try {
    adapter = await navigator.gpu.requestAdapter();
  } catch {
    throw new GpuFailure(
      "adapter-unavailable",
      "Chrome could not access a WebGPU adapter.",
    );
  }
  if (adapter === null) {
    throw new GpuFailure(
      "adapter-unavailable",
      "No WebGPU adapter is available.",
    );
  }
  try {
    return await adapter.requestDevice();
  } catch {
    throw new GpuFailure(
      "device-request-failed",
      "The WebGPU adapter could not create a graphics device.",
    );
  }
}

function createPipeline(
  device: GPUDevice,
  format: GPUTextureFormat,
): GPURenderPipeline {
  const module = device.createShaderModule({
    code: `
@vertex
fn vertex_main(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let positions = array<vec2f, 3>(
    vec2f(0.0, 0.5),
    vec2f(-0.5, -0.5),
    vec2f(0.5, -0.5)
  );
  return vec4f(positions[index], 0.0, 1.0);
}

@fragment
fn fragment_main() -> @location(0) vec4f {
  return vec4f(1.0, 0.0, 0.0, 1.0);
}
`,
  });
  return device.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vertex_main" },
    fragment: {
      module,
      entryPoint: "fragment_main",
      targets: [{ format }],
    },
    primitive: { topology: "triangle-list" },
  });
}

async function draw(
  device: GPUDevice,
  context: GPUCanvasContext,
  pipeline: GPURenderPipeline,
): Promise<void> {
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      },
    ],
  });
  pass.setPipeline(pipeline);
  pass.draw(3);
  pass.end();
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
  if (document.body.dataset["gpuStatus"] !== "error") {
    document.body.dataset["gpuStatus"] = "ready";
  }
}

async function start(): Promise<void> {
  const device = await requestDevice();
  const context = canvas?.getContext("webgpu");
  if (context === null || context === undefined || canvas === null) {
    throw new GpuFailure(
      "context-unavailable",
      "The canvas could not create a WebGPU drawing context.",
    );
  }
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });
  const pipeline = createPipeline(device, format);
  const observer = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (entry === undefined || canvas.hidden) {
      return;
    }
    const size = entry.devicePixelContentBoxSize[0];
    canvas.width = Math.max(
      1,
      size?.inlineSize ??
        Math.round(entry.contentRect.width * devicePixelRatio),
    );
    canvas.height = Math.max(
      1,
      size?.blockSize ??
        Math.round(entry.contentRect.height * devicePixelRatio),
    );
    draw(device, context, pipeline).catch(showFailure);
  });
  device.lost
    .then((info) => {
      observer.disconnect();
      showFailure(
        new GpuFailure(
          "device-lost",
          `The WebGPU graphics device was lost (${info.reason}). ${info.message}`.trim(),
        ),
      );
    })
    .catch(showFailure);
  device.addEventListener("uncapturederror", (event) => {
    event.preventDefault();
    observer.disconnect();
    showFailure(new GpuFailure("context-unavailable", event.error.message));
  });
  observer.observe(canvas, { box: "device-pixel-content-box" });
}

start().catch(showFailure);
