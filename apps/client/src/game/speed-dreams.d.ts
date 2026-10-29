declare module "*/wasm/speed-dreams.js" {
  export interface SpeedDreamsModule {
    HEAPF64: Float64Array;
    HEAPF32: Float32Array;
    cwrap(
      name: "sdInit",
      returns: "number",
      args: ["string", "string", "string", "string", "number"],
    ): (
      category: string,
      track: string,
      race: string,
      car: string,
      now: number,
    ) => number;
    cwrap(
      name: "sdCarParamStr",
      returns: "string",
      args: ["string", "string"],
    ): (path: string, key: string) => string;
    cwrap(
      name: "sdCarParamNum",
      returns: "number",
      args: ["string", "string", "number"],
    ): (path: string, key: string, fallback: number) => number;
    cwrap(
      name: "sdCarLimits",
      returns: "number",
      args: ["string", "string", "string", "string", "number"],
    ): (
      car: string,
      path: string,
      key: string,
      unit: string,
      out: number,
    ) => number;
    cwrap(
      name: "sdCarParamCount",
      returns: "number",
      args: ["string"],
    ): (path: string) => number;
    _sdKey(key: number, state: number): void;
    _sdUpdate(now: number): number;
    _sdStep(count: number): number;
    _sdFrame(): number;
    _sdTrackLength(): number;
    _sdTrackLocal2Global(
      toStart: number,
      toMiddle: number,
      out: number,
    ): number;
    _sdTrackInfo(out: number): void;
    _sdCarInfo(out: number): void;
    _sdTelemetry(out: number): void;
    _sdHudInfo(out: number): void;
    _sdTrackSectors(out: number, max: number): number;
    _sdInputAssist(on: number): void;
    _sdInputAnalog(
      active: number,
      steer: number,
      throttle: number,
      brake: number,
    ): void;
    _sdCarName(): number;
    _sdViewKey(key: number, ctrl: number): number;
    _sdViewResize(width: number, height: number): void;
    UTF8ToString(pointer: number): string;
    _malloc(size: number): number;
    _free(pointer: number): void;
    FS: {
      readFile(path: string, options: { encoding: "utf8" }): string;
      writeFile(path: string, data: string): void;
      analyzePath(path: string): { exists: boolean };
      mkdirTree(path: string): void;
    };
  }
  export default function createSpeedDreams(options?: {
    print?: (text: string) => void;
    printErr?: (text: string) => void;
  }): Promise<SpeedDreamsModule>;
}
