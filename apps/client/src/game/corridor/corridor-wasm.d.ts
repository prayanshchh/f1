declare module "*/wasm/corridor.js" {
  export interface CorridorModule {
    wasmMemory: WebAssembly.Memory;
    PThread: { terminateAllThreads(): void };
    _malloc(bytes: number): number;
    _free(pointer: number): void;
    _cr_init(threads: number): void;
    _cr_resize(width: number, height: number): void;
    _cr_texture(
      pointer: number,
      width: number,
      height: number,
      flags: number,
    ): number;
    _cr_texture_async(
      pointer: number,
      width: number,
      height: number,
      flags: number,
    ): number;
    _cr_texture_ready(texture: number): number;
    _cr_mesh(
      positions: number,
      normals: number,
      uvs: number,
      colours: number,
      indices: number,
      vertexCount: number,
      indexCount: number,
      texture: number,
      r: number,
      g: number,
      b: number,
    ): number;
    _cr_mesh_cull(mesh: number, cull: number): void;
    _cr_mesh_texture(mesh: number, texture: number): void;
    _cr_mesh_bias(mesh: number, bias: number): void;
    _cr_ground(
      r: number,
      g: number,
      b: number,
      from: number,
      fade: number,
    ): void;
    _cr_release_mesh(mesh: number): void;
    _cr_release_texture(texture: number): void;
    _cr_sky(
      zenithR: number,
      zenithG: number,
      zenithB: number,
      horizonR: number,
      horizonG: number,
      horizonB: number,
    ): void;
    _cr_busy(): number;
    _cr_submit(
      camera: number,
      list: number,
      count: number,
      matrices: number,
      matrixCount: number,
      light: number,
    ): number;
    _cr_frame(
      camera: number,
      list: number,
      count: number,
      matrices: number,
      matrixCount: number,
      light: number,
    ): number;
    _cr_pixels(): number;
    _cr_shown(): number;
    _cr_triangles(): number;
    _cr_raster_ms(): number;
    _cr_transform_ms(): number;
    _cr_shaded(): number;
    _cr_frame_ms(): number;
  }
  export default function createCorridor(): Promise<CorridorModule>;
}
